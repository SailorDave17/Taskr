package com.taskr.core.Resources;

import org.hibernate.annotations.Fetch;
import org.hibernate.annotations.FetchMode;

import javax.persistence.*;
import java.util.*;

@Entity
public class TaskTemplate {
    @Id
    @GeneratedValue
    private long id;
    private String name;
    private Integer minutesExpectedToComplete;
    private String description;
    private Integer actualWorkTime;
    @Fetch(value = FetchMode.SELECT)
    @ManyToMany//(fetch = FetchType.EAGER, mappedBy = "tasksUserCannotDo", cascade = CascadeType.ALL)
    private Collection<User> usersWhoCannotDoThisTask;

    public TaskTemplate(String name, String description, Integer actualWorkTime, Integer minutesExpectedToComplete, User ... usersWhoCannotDoThisTask) {
        this.name = name;
        this.description = description;
        this.actualWorkTime = actualWorkTime;
        this.minutesExpectedToComplete = minutesExpectedToComplete;
        this.usersWhoCannotDoThisTask = new HashSet<>(Arrays.asList(usersWhoCannotDoThisTask));
    }

    public TaskTemplate(String name, String description, Integer actualWorkTime, User ... usersWhoCannotDoThisTask) {
        this.name = name;
        this.description = description;
        this.actualWorkTime = actualWorkTime;
        this.minutesExpectedToComplete = actualWorkTime;
        this.usersWhoCannotDoThisTask = new HashSet<>(Arrays.asList(usersWhoCannotDoThisTask));
    }

    public TaskTemplate(String name, int minutesExpectedToComplete, int actualWorkTime) {
        this.name = name;
        this.description = "";
        this.actualWorkTime = actualWorkTime;
        this.minutesExpectedToComplete = minutesExpectedToComplete;
        this.usersWhoCannotDoThisTask = new HashSet<>();
    }

    public TaskTemplate() {

    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public long getId() {
        return id;
    }

    public Integer getMinutesExpectedToComplete() {
        return minutesExpectedToComplete;
    }

    public void setMinutesExpectedToComplete(Integer minutesExpectedToComplete) {
        this.minutesExpectedToComplete = minutesExpectedToComplete;
    }

    public void setActualWorkTime(Integer actualWorkTime) {
        this.actualWorkTime = actualWorkTime;
    }

    public Integer getActualWorkTime() {
        return actualWorkTime;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public Collection<User> getUsersWhoCannotDoThisTask() {
        return usersWhoCannotDoThisTask;
    }

    public void addUserWhoCannotDoThisTask(User user) {
        if(usersWhoCannotDoThisTask == null){
            usersWhoCannotDoThisTask = new HashSet<>();
        }
        this.usersWhoCannotDoThisTask.add(user);
        user.addTaskUserCannotDo(this);
    }

    public void removeUserWhoCannotDoThisTask(User user){
        this.usersWhoCannotDoThisTask.remove(user);
        user.removeTaskUserCannotDo(this);
    }

    public void setUsersWhoCannotDoThisTask(Iterable<User> usersWhoCannotDoThisTask) {
        usersWhoCannotDoThisTask = new HashSet<>();
        for (User user : usersWhoCannotDoThisTask) {
            this.usersWhoCannotDoThisTask.add(user);
            user.addTaskUserCannotDo(this);
        }
    }

    @Override
    public String toString() {
        return "TaskTemplate{" +
                "id=" + id +
                ", name='" + name + '\'' +
                ", minutesExpectedToComplete=" + minutesExpectedToComplete +
                ", description='" + description + '\'' +
                ", actualWorkTime=" + actualWorkTime +
                '}';
    }
}
