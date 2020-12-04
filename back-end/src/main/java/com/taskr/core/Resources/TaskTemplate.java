package com.taskr.core.Resources;

import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.Id;
import javax.persistence.OneToMany;
import java.util.HashSet;
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
    @OneToMany
    private Set<User> usersWhoCanDoThisTask;

    public TaskTemplate(String name) {
        this.name = name;
        this.description = "";
        this.actualWorkTime = 0;
        this.minutesExpectedToComplete = 0;
        this.usersWhoCanDoThisTask = new HashSet<>();
    }

    public TaskTemplate() {

    }

    public String getName() {
        return  name;
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
    public Set<User> getUsersWhoCanDoThisTask(){
        return usersWhoCanDoThisTask;
    }

    public void addUserWhoCanDoThisTask(User user){
        this.usersWhoCanDoThisTask.add(user);
    }

    public void setUsersWhoCanDoThisTask(Iterable<User> usersWhoCanDoThisTask) {
        for (User user : usersWhoCanDoThisTask){
            this.usersWhoCanDoThisTask.add(user);
        }
    }
}
