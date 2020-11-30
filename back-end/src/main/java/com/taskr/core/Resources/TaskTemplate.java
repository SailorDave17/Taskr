package com.taskr.core.Resources;

import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.Id;
import javax.persistence.OneToMany;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Set;

@Entity
public class TaskTemplate {
    @Id
    @GeneratedValue
    private long id;
    private String name;
    private int minutesExpectedToComplete = 0;
    private String description;
    private int actualWorkTime = 0;
    @OneToMany
    private Set<User> usersWhoCanDoThisTask;

    public TaskTemplate(String name) {
        this.name = name;
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

    public int getMinutesExpectedToComplete() {
        return minutesExpectedToComplete;
    }

    public void setMinutesExpectedToComplete(int minutesExpectedToComplete) {
        this.minutesExpectedToComplete = minutesExpectedToComplete;
    }

    public void setActualWorkTime(int actualWorkTime) {
        this.actualWorkTime = actualWorkTime;
    }

    public int getActualWorkTime() {
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

    public void setUsersWhoCanDoThisTask(Set<User> usersWhoCanDoThisTask) {
        this.usersWhoCanDoThisTask = usersWhoCanDoThisTask;
    }
}
