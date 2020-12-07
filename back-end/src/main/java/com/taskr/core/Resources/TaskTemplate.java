package com.taskr.core.Resources;

import javax.persistence.*;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Set;

@Entity
public class TaskTemplate {
    @Id
    @GeneratedValue
    private long id;
    private String name;
    private Integer minutesExpectedToComplete;
    private String description;
    private Integer actualWorkTime;
    @ManyToMany(fetch = FetchType.EAGER, mappedBy = "tasksUserCannotDo", cascade = CascadeType.ALL)
    private Collection<User> usersWhoCannotDoThisTask = new LinkedHashSet<>();

    public TaskTemplate(String name, String description, Integer actualWorkTime, Integer minutesExpectedToComplete) {
        this.name = name;
        this.description = description;
        this.actualWorkTime = actualWorkTime;
        this.minutesExpectedToComplete = minutesExpectedToComplete;
        this.usersWhoCannotDoThisTask = new HashSet<>();
    }

    public TaskTemplate(String name, String description, Integer actualWorkTime) {
        this.name = name;
        this.description = description;
        this.actualWorkTime = actualWorkTime;
        this.minutesExpectedToComplete = actualWorkTime;
        this.usersWhoCannotDoThisTask = new HashSet<>();
    }

    public TaskTemplate(String name) {
        this.name = name;
        this.description = "";
        this.actualWorkTime = 0;
        this.minutesExpectedToComplete = 0;
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
        this.usersWhoCannotDoThisTask.add(user);
    }

    public void setUsersWhoCannotDoThisTask(Iterable<User> usersWhoCannotDoThisTask) {
        for (User user : usersWhoCannotDoThisTask) {
            this.usersWhoCannotDoThisTask.add(user);
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
